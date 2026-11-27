// The spec XcodeGen makes an app's Xcode project from. The build workers use it, and so does the
// folder of source a person downloads, so that what they open is the project that was built here.

/**
 * The XcodeGen spec. Only the app name and bundle id vary, and both are written as quoted JSON strings.
 * With `publish`, the project is also set up for a signed store build: team, build number and app icon.
 */
export function projectSpec(
  job: { appName: string; bundleId: string },
  publish?: { teamId: string; buildNumber: string },
): string {
  // Control characters and "$" (build-setting expansion) are dropped from the name.
  const cleaned = job.appName.replace(/[\u0000-\u001f]/g, ' ').replace(/[$\\]/g, '').replace(/\s+/g, ' ').trim();
  const displayName = JSON.stringify(cleaned.slice(0, 30) || 'App');
  return `name: App
options:
  createIntermediateGroups: true
  deploymentTarget:
    iOS: "17.0"
targets:
  App:
    type: application
    platform: iOS
    sources:
      - path: Sources${publish ? '\n      - path: Resources' : ''}
    scheme: {}
    settings:
      base:
        PRODUCT_NAME: App
        PRODUCT_BUNDLE_IDENTIFIER: ${JSON.stringify(job.bundleId)}
        MARKETING_VERSION: "1.0"
        CURRENT_PROJECT_VERSION: ${JSON.stringify(publish?.buildNumber ?? '1')}
        SWIFT_VERSION: "5.0"
        TARGETED_DEVICE_FAMILY: "1"
        GENERATE_INFOPLIST_FILE: YES
        INFOPLIST_KEY_CFBundleDisplayName: ${displayName}
        INFOPLIST_KEY_UILaunchScreen_Generation: YES
        INFOPLIST_KEY_UISupportedInterfaceOrientations: UIInterfaceOrientationPortrait
        INFOPLIST_KEY_UIApplicationSceneManifest_Generation: YES
${
  publish
    ? `        DEVELOPMENT_TEAM: ${JSON.stringify(publish.teamId)}
        CODE_SIGN_STYLE: Automatic
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
        INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: NO
`
    : ''
}`;
}
