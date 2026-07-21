# Bundled Vibe-Trading Runtime

SparkFlow vendors the Vibe-Trading research backend here so a repository clone
does not depend on a separate checkout elsewhere on the computer.

The source is derived from [HKUDS/Vibe-Trading](https://github.com/HKUDS/Vibe-Trading)
at commit `a68c6852d843ded0118f0a289dcbe3e8eebd7a39` and remains available under the
MIT License. See `LICENSE` and `NOTICE` in this directory. SparkFlow excludes
the upstream frontend, tests, generated assets, local credentials, logs, runs,
and session data.

The first SparkFlow start creates `services/vibe-trading/.venv` and installs
this package in editable mode. Runtime credentials are written only to the
ignored `agent/.env` file through the local settings API.

SparkFlow carries small integration patches for Windows-safe secret writes and
placeholder-key detection. Core research behavior remains in the vendored
upstream modules.
