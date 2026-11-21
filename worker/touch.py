"""Keeps a way in to a simulator open and feeds it touches the moment they arrive.

Started by the worker with the Python that `idb` itself runs on, so the idb library is at hand.
Reads one JSON object per line on stdin; coordinates are in the simulator's points:

  {"k": "down" | "move" | "up", "x": 120, "y": 300}
  {"k": "swipe", "x1": .., "y1": .., "x2": .., "y2": .., "duration": 0.3}
  {"k": "text", "text": "hej"}
  {"k": "key", "code": 42}
  {"k": "button", "name": "HOME"}

Each gesture, from the finger going down until it lifts, is one stream to the simulator, which
answers when the stream is closed. That answer is how this helper knows the touches arrived: the
simulator starts listening for touches only when the first ones are sent, and throws away what
comes before it is ready without a word. So the helper first sends a finger lifting that was never
down, waits for the answer, and only then prints "ready" on stdout. Anything that goes wrong is
written to stderr, and a helper that gets no answer exits, for the worker to start afresh.
"""

import asyncio
import json
import logging
import os
import shutil
import sys

from idb.common.hid import button_press_to_events, key_press_to_events, text_to_events
from idb.common.types import HIDButtonType, HIDDirection, HIDPress, HIDSwipe, HIDTouch, Point
from idb.grpc.management import ClientManager

# A finger lifting that was never down: it wakes the simulator up and touches nothing.
WAKE = {"k": "up", "x": 0, "y": 0}
# How long the simulator gets to answer once a gesture has been sent in full.
ANSWER_SECONDS = 5
# A finger that is down and has not been heard from for this long belongs to someone who went away.
FORGOTTEN_SECONDS = 20


def events_for(message):
    kind = message.get("k")
    if kind in ("down", "move", "up"):
        # A finger that is down at a new place has moved there: that is how the simulator reads it.
        direction = HIDDirection.UP if kind == "up" else HIDDirection.DOWN
        point = Point(x=float(message["x"]), y=float(message["y"]))
        return [HIDPress(action=HIDTouch(point=point), direction=direction)]
    if kind == "swipe":
        start = Point(x=float(message["x1"]), y=float(message["y1"]))
        end = Point(x=float(message["x2"]), y=float(message["y2"]))
        return [HIDSwipe(start=start, end=end, delta=None, duration=float(message.get("duration", 0.3)))]
    if kind == "text":
        return text_to_events(str(message["text"]))
    if kind == "key":
        return key_press_to_events(int(message["code"]))
    if kind == "button":
        return button_press_to_events(HIDButtonType[str(message["name"])])
    return []


def safe_events(message):
    try:
        return events_for(message)
    except (KeyError, ValueError, TypeError) as error:
        print(f"bad message: {error}", file=sys.stderr, flush=True)
        return []


def lift(finger):
    return {"k": "up", "x": finger["x"], "y": finger["y"]}


async def read_lines(queue):
    """Puts every message from stdin on the queue, and None when stdin closes."""
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            await queue.put(None)
            return
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if isinstance(message, dict) and "k" in message:
            await queue.put(message)


class Gesture:
    """One gesture's events, in order, taken off the queue as they arrive."""

    def __init__(self, first, queue):
        self.first = first
        self.queue = queue
        # Set when everything has been handed over, so that the answer can be waited for.
        self.sent = asyncio.Event()
        # True when stdin closed while this gesture was being read.
        self.closed = False

    async def events(self):
        message = self.first
        while True:
            for event in safe_events(message):
                yield event
            if message["k"] not in ("down", "move"):
                # The finger lifted, or it was something done in one go: the gesture is over.
                break
            finger = message
            try:
                message = await asyncio.wait_for(self.queue.get(), FORGOTTEN_SECONDS)
            except asyncio.TimeoutError:
                message = lift(finger)
            if message is None:
                self.closed = True
                message = lift(finger)
            # A finger's older positions are dropped when newer ones are already waiting.
            while message["k"] == "move" and not self.queue.empty():
                newer = self.queue.get_nowait()
                if newer is None:
                    self.closed = True
                    message = lift(message)
                elif newer["k"] == "move":
                    message = newer
                else:
                    # Not skipped past: the finger goes where it last was, and then this happens.
                    for event in safe_events(message):
                        yield event
                    message = newer
        self.sent.set()


async def perform(client, gesture):
    """Sends one gesture and waits for the simulator's answer. Raises when none comes."""
    stream = asyncio.ensure_future(client.hid(gesture.events()))
    sent = asyncio.ensure_future(gesture.sent.wait())
    await asyncio.wait({stream, sent}, return_when=asyncio.FIRST_COMPLETED)
    sent.cancel()
    try:
        await asyncio.wait_for(stream, ANSWER_SECONDS)
    except asyncio.TimeoutError:
        raise RuntimeError("the simulator did not answer") from None


async def wake(client):
    """True once the simulator has answered a touch, which is when it listens to them."""
    for attempt in range(8):
        try:
            await perform(client, Gesture(WAKE, asyncio.Queue()))
            return True
        except Exception as error:
            print(f"the simulator is not listening yet (try {attempt + 1}): {error}", file=sys.stderr, flush=True)
            await asyncio.sleep(0.5)
    return False


async def serve(client):
    if not await wake(client):
        return 1
    queue = asyncio.Queue()
    asyncio.ensure_future(read_lines(queue))
    print("ready", flush=True)
    while True:
        message = await queue.get()
        if message is None:
            return 0
        gesture = Gesture(message, queue)
        try:
            await perform(client, gesture)
        except Exception as error:
            # What was sent may not have arrived. Better to start afresh than to go on unheard.
            print(f"a gesture got no answer: {error}", file=sys.stderr, flush=True)
            return 1
        if gesture.closed:
            return 0


async def main(udid):
    logger = logging.getLogger("touch")
    manager = ClientManager(companion_path=shutil.which("idb_companion"), logger=logger)
    # Something else may be opening its own way in to the simulator at this very moment, and only
    # one of the two gets to start what they both talk to. The other tries again.
    for attempt in range(5):
        try:
            async with manager.from_udid(udid=udid) as client:
                return await serve(client)
        except Exception as error:
            print(f"could not reach the simulator (try {attempt + 1}): {type(error).__name__}", file=sys.stderr, flush=True)
            await asyncio.sleep(1 + attempt)
    return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    try:
        code = asyncio.run(main(sys.argv[1]))
    except KeyboardInterrupt:
        code = 0
    sys.stdout.flush()
    sys.stderr.flush()
    # Not sys.exit: a read of stdin that is still waiting in its thread must not keep the helper alive.
    os._exit(code)
