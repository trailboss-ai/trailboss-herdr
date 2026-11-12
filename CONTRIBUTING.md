# Contributing to the Trailboss Herdr mod

The mod is a thin frontend: everything it shows comes from the `trailboss` CLI's `--json` output, described in [trailboss-specification](https://github.com/trailboss-ai/trailboss-specification). Report problems in [trailboss-ai/trailboss](https://github.com/trailboss-ai/trailboss/issues).

## Working on it

```sh
python3 install.py --get-cli        # the CLI, if you don't have it
python3 install.py                  # or --update after changes
herdr-app check mods/trailboss      # type-checks the mod
for t in mods/trailboss/*.test.mjs mods/trailboss/*/*.test.mjs; do node "$t"; done
python3 test_setup_mod.py
python3 test_install.py
```

- Pure logic goes in small node-tested modules (`cli.js`, `fleet/tree.js`, `files/diff.js`…), next to a `.test.mjs`.
- Read only fields the specification describes. A feature that needs a new field starts with the specification and the CLI; the mod then raises `NEEDS` in `mods/trailboss/cli.js` to the CLI version that has it.
- Nothing is downloaded or written outside Herdr's own folders except on a user's click.
- Never commit real transcripts or session data.

## License and contributor terms

This repository is released under the [MIT License](LICENSE). By submitting a contribution (code, documentation, fixtures or anything else) through a pull request, patch or other means, you agree to the following:

1. **You keep your copyright.** Your contribution is licensed to everyone under the MIT License, the same as the rest of the project.
2. **You also grant the maintainer the right to relicense it.** You grant Manas Talukdar, and anyone the project is transferred to, a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, copy, modify, distribute and sublicense your contribution, and to release it under other license terms, including commercial or proprietary ones, alongside or instead of the MIT License. Versions already released under MIT stay available under MIT.
3. **You have the right to contribute it.** The contribution is your own work, or you have permission to submit it under these terms, and it isn't subject to an employer's or anyone else's claim that would conflict with them. If your employer has rights to your work, you have their permission.
4. **Third-party code is marked.** Anything you didn't write yourself is called out in the pull request, with its source and license, and noted in the README. It must be under a license compatible with these terms (MIT, Apache-2.0, BSD or similar).

Sign off each commit to confirm this (`git commit -s`, which adds `Signed-off-by: Your Name <you@example.com>`). Pull requests whose commits aren't signed off can't be merged.

Why: the core stays MIT, but this keeps the option to offer Trailboss, or parts of it, under other terms later without having to find and ask every past contributor.
