class WorkerError(Exception):
    """Base for sprisk-workers errors."""


class ProtocolError(WorkerError):
    """Inbound message was invalid or arrived out of order. The worker stops."""


class OperatorError(WorkerError):
    """The operator cannot succeed with these inputs and params. Never retried."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class ManifestError(WorkerError):
    """An operator manifest is invalid or its entrypoint cannot be loaded."""


class RuleError(WorkerError):
    """A methodology rule could not be loaded, or read or returned an invalid message."""
