from datetime import datetime, timedelta


def parse_iso_datetime(value):
    if not value:
        return None

    normalized = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is not None:
        return parsed.astimezone().replace(tzinfo=None)
    return parsed


def get_named_range(range_name, now=None):
    current = now or datetime.now()
    name = range_name or "this_week"

    if name == "today":
        start = current.replace(hour=0, minute=0, second=0, microsecond=0)
        end = current.replace(hour=23, minute=59, second=59, microsecond=999999)
    elif name == "tomorrow":
        target = current + timedelta(days=1)
        start = target.replace(hour=0, minute=0, second=0, microsecond=0)
        end = target.replace(hour=23, minute=59, second=59, microsecond=999999)
    else:
        monday = current - timedelta(days=current.weekday())
        start = monday.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7) - timedelta(microseconds=1)
        name = "this_week"

    return start, end, name


def resolve_query_range(query_range):
    if isinstance(query_range, dict):
        start = parse_iso_datetime(query_range.get("start"))
        end = parse_iso_datetime(query_range.get("end"))
        label = query_range.get("label", "custom")
        if start and end:
            return start, end, label

    return get_named_range(query_range or "this_week")


def get_range_from_request(args):
    start = parse_iso_datetime(args.get("start"))
    end = parse_iso_datetime(args.get("end"))
    if start and end:
        return start, end, "custom"
    return get_named_range(args.get("range", "this_week"))


def serialize_range(start, end, label):
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "label": label,
    }
