"""Shared loopback-controller process ownership and private key entry."""
import getpass
import os
import re
from .contracts import key


class ProcessLock:
    """An OS lock, not a stale PID file; fixed listening port is a second guard."""
    def __init__(self, path):
        self.file = open(path, "a+b")

    def __enter__(self):
        try:
            if os.name == "nt":
                import msvcrt
                self.file.seek(0)
                self.file.write(b"0")
                self.file.flush()
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.file.close()
            raise ValueError("Another local controller already owns this session") from error
        return self

    def __exit__(self, *_args):
        self.file.close()


def normalize_route_key(value):
    """Accept the firmware line or its quoted value without changing key bytes."""
    if not isinstance(value, str):
        key(value)
    value = value.strip()
    match = re.fullmatch(r'(?:#define[ \t]+AMR_ROUTE_KEY[ \t]+)?"([0-9a-f]{64})"(?:[ \t]*//[^\r\n]*)?', value)
    if match:
        value = match.group(1)
    key(value)  # Never lowercase, remove internal characters or weaken authentication.
    return value


def read_route_key():
    configured = os.environ.get("AMR_DRIVE_KEY")
    if configured:
        try:
            return normalize_route_key(configured)
        except ValueError:
            raise ValueError("AMR_DRIVE_KEY must contain the 64-character lowercase hexadecimal route key; clear it to use the hidden prompt") from None
    while True:
        try:
            value = getpass.getpass("Private AMR_ROUTE_KEY from the local-route firmware (hidden; paste then press Enter): ")
        except (EOFError, KeyboardInterrupt):
            print("\nKey entry cancelled. No camera or controller connection was started.")
            return None
        try:
            return normalize_route_key(value)
        except ValueError:
            # No input, substring or fingerprint is echoed into console logs.
            print("Key format not recognised. Copy all 64 characters from AMR_ROUTE_KEY in private_amr_settings.h. "
                  "The full #define AMR_ROUTE_KEY line is also accepted. Try again, or press Ctrl+C to cancel.")

