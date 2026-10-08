# License overrides for bundled npm packages

The client build lists each npm package that it puts into the app, with its license text
(#554, `scripts/third-party-npm.mjs`). Most packages ship a license file. When a package
does not, the build reads the license text from this folder.

- The file name is `<name>@<version>.txt`. In a scoped name, use `+` in place of `/`.
- An override applies to that exact version only.
- When a package has no license file and no override, `npm run build` fails and names the
  package.

## Add an override

1. Read the license of that exact version: its `package.json`, its repository at the
   version tag, and its README.
2. Write the file. Start with two or three lines that say where the text comes from.
3. Then put the license text, with the copyright holder. If the package names a license
   but ships no text, use the standard text of that license, with the `author` from
   `package.json` as the holder.

When a package version changes, read the new version, then rename the file or delete it.
