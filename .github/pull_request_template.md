## What does this change?

<!-- A short description. If it fixes an issue, write "Fixes #123". -->

## How did you test it?

<!-- e.g. "Opened the example X and pressed Run", "node serve.js and checked in Edge and on an iPad". -->

## Checklist

- [ ] The web version still loads without errors (`node serve.js`, then http://localhost:8080)
- [ ] New scripts are in `web/index.html` both as `<script>` and as `<link rel="preload">` (in the same order)
- [ ] Rust changes: `cargo test -p wb-core` passes
- [ ] User-facing changes are described in Help (`web/js/help.js`) if needed
