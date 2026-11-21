"""Hands a simulator's screen on as video, piece by piece, the moment each piece comes.

Started by the worker with the Python that `idb` itself runs on, so the idb library is at hand:

  video.py <udid> <pictures a second at most>

The `idb video-stream` command would do, were it not that it gathers its output up before writing
it: small pictures, as of a screen where little moves, then arrive seconds late and in clumps.
Here every piece is written at once, with its length in front of it as four bytes (big-endian),
so the reader knows where each one ends without waiting for the next. A piece is one unit of
H.264 with its start code, or several.

When told to stop (SIGTERM) the helper first tells the simulator's companion that the video is
over. A stream that is just dropped goes on being encoded there, and every such leftover makes
the next one slower. Anything that goes wrong is written to stderr.
"""

import asyncio
import logging
import os
import shutil
import signal
import struct
import sys

from idb.common.types import VideoFormat
from idb.grpc.management import ClientManager


async def stream(udid, fps):
    logger = logging.getLogger("video")
    manager = ClientManager(companion_path=shutil.which("idb_companion"), logger=logger)
    out = sys.stdout.buffer
    async with manager.from_udid(udid=udid) as client:
        # 0.2 is what the idb command itself asks for.
        video = client.stream_video(output_file=None, fps=fps, format=VideoFormat.H264, compression_quality=0.2)
        try:
            async for piece in video:
                out.write(struct.pack(">I", len(piece)))
                out.write(piece)
                out.flush()
        finally:
            # Closing it is what says "stop" to the companion.
            try:
                await video.aclose()
            except Exception:
                pass


async def main(udid, fps):
    work = asyncio.ensure_future(stream(udid, fps))
    loop = asyncio.get_running_loop()
    for sign in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sign, work.cancel)
    try:
        await work
    except asyncio.CancelledError:
        pass
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    try:
        code = asyncio.run(main(sys.argv[1], int(sys.argv[2])))
    except BrokenPipeError:
        code = 0
    except Exception as error:
        print(f"video stopped: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
        code = 1
    os._exit(code)
