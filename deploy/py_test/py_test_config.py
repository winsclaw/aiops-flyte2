from pathlib import Path


ENV_PATH = Path(__file__).with_name(".env")


class ConfigError(RuntimeError):
    pass


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def load_env_file(path: Path | None = None) -> dict[str, str]:
    env_path = path or ENV_PATH
    if not env_path.exists():
        raise ConfigError(f".env not found: {env_path}")

    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(env_path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ConfigError(f"Invalid .env line {line_number}: expected KEY=value")

        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            raise ConfigError(f"Invalid .env line {line_number}: key is empty")
        values[key] = _unquote(value.strip())

    return values


def require_config(
    required_keys: list[str],
    *,
    optional_empty_keys: set[str] | None = None,
) -> dict[str, str]:
    values = load_env_file()
    optional_empty_keys = optional_empty_keys or set()
    missing = [
        key
        for key in required_keys
        if key not in values or (values[key] == "" and key not in optional_empty_keys)
    ]
    if missing:
        raise ConfigError(f"Missing required .env key(s): {', '.join(missing)}")
    return values


def resolve_env_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return ENV_PATH.parent / path
