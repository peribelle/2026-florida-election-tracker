#!/usr/bin/env python3
"""What every collector does the moment its pull is on disk: ask for a validation, then ask for a publish.

Both asks return at once and hand the work to a detached worker behind its own lock, so neither can delay or break a pull.
The two are separate on purpose: a bug in one must not stop the other, so each is guarded on its own.

  NO_VALIDATE=1  skips the validation ask      NO_PUBLISH=1  skips the publish ask
"""
import importlib


def after_pull():
    for module, fn in (("validate", "queue_validate"), ("publish", "queue_publish")):
        try:
            getattr(importlib.import_module(module), fn)()
        except Exception as e:
            print(f"  ! {module}.{fn} failed: {str(e)[:80]}")


if __name__ == "__main__":
    after_pull()
