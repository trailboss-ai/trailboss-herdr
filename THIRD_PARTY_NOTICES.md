# Third-party notices

## insights: usage metrics

The Insights window (`mods/trailboss/usage/insights.js`) is ported in shape from, and the
provider logos in `mods/trailboss/logos/` come from, the insights mod in
[GaganSD/coding-agent-toolkit](https://github.com/GaganSD/coding-agent-toolkit) (`herdr-insights/`).

```
MIT License

Copyright (c) 2026 Gagan Devagiri

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Herdr: the spaces list

`mods/trailboss/spaces/base.js` is Herdr app's own spaces mod (`defaults/mods/spaces/main.js`
in [herdrdev/herdr-app](https://github.com/herdrdev/herdr-app), as shipped in herdr-app 0.1.13),
copied unchanged. It's licensed under the Apache License 2.0, whose text is in
`mods/trailboss/spaces/LICENSE-APACHE`. `mods/trailboss/spaces/folders.js` extends it, and
the parts of it that follow `base.js` (ordering spaces, a space's row) are derived from that
file under the same license.
