# ATS GPS for iPad

The iPad app: a full-screen window onto the page ATS GPS serves on the PC (its iPad page), plus screen-awake
and haptics. Its project (`ios/`, an XcodeGen spec) is built into an unsigned `TruckRemote.ipa` by GitHub Actions
(`.github/workflows/build-ios.yml`, run from the GitHub repository Peteda2wat/truck-remote, where this folder
was the repository's root), then sideloaded with Sideloadly. The app only loads the page from the PC, so
changes to the program never need a new app build.
