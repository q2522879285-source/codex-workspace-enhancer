"""Index and query a frozen legacy Codex JSONL archive; never edits active tasks."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3

CHUNK = 1024 * 1024


def records(stream):
    while True:
        offset = stream.tell()
        prefix = stream.readline(CHUNK)
        if not prefix:
            return
        part = prefix
        while not part.endswith(b'\n'):
            part = stream.readline(CHUNK)
            if not part:
                break
        yield offset, stream.tell() - offset, prefix


def fields(prefix, length):
    if length <= len(prefix):
        obj = json.loads(prefix)
        payload = obj.get('payload')
        subtype = payload.get('type', '') if isinstance(payload, dict) else ''
        return obj.get('timestamp', ''), obj.get('type', ''), subtype, payload
    # ponytail: large records use the observed legacy header order; other orders remain raw-export only.
    head = re.match(rb'^\{\s*"timestamp"\s*:\s*"([^"\\]*)"\s*,\s*"type"\s*:\s*"([^"\\]+)"\s*,\s*"payload"\s*:', prefix)
    if not head:
        return '', '', '', None
    sub = re.match(rb'\s*\{\s*"type"\s*:\s*"([^"\\]+)"', prefix[head.end():])
    return head[1].decode(), head[2].decode(), sub[1].decode() if sub else '', None


def build_index(archive, index=None):
    source = archive / 'original.jsonl'
    index = index if index is not None else archive / 'cold-index.sqlite'
    before = source.stat()
    with index.open('xb'):
        pass
    count = messages = oversized = unknown = 0
    try:
        with closing(sqlite3.connect(index)) as db, source.open('rb') as stream:
            db.execute('CREATE TABLE records (id INTEGER PRIMARY KEY, offset INTEGER, length INTEGER, timestamp TEXT, kind TEXT, subtype TEXT)')
            db.execute('CREATE TABLE messages (record_id INTEGER PRIMARY KEY, timestamp TEXT, role TEXT, text TEXT)')
            for count, (offset, length, prefix) in enumerate(records(stream), 1):
                stamp, kind, subtype, payload = fields(prefix, length)
                db.execute('INSERT INTO records VALUES (?,?,?,?,?,?)', (count, offset, length, stamp, kind, subtype))
                if not kind:
                    unknown += 1
                if (kind == 'event_msg' and subtype in ('user_message', 'agent_message')) or (kind == 'response_item' and subtype == 'message'):
                    if payload is None:
                        oversized += 1
                        continue
                    if kind == 'event_msg':
                        role = 'user' if subtype == 'user_message' else 'assistant'
                        text = payload.get('message')
                    else:
                        role = payload.get('role')
                        content = payload.get('content')
                        text = '\n'.join(
                            block['text'] for block in content
                            if isinstance(block, dict) and block.get('type') in ('input_text', 'output_text')
                            and isinstance(block.get('text'), str)
                        ) if isinstance(content, list) else ''
                    if role in ('user', 'assistant') and isinstance(text, str) and text.strip():
                        db.execute('INSERT INTO messages VALUES (?,?,?,?)', (count, stamp, role, text))
                        messages += 1
            after = source.stat()
            if not count or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError('Archive is empty or changed during indexing')
            db.commit()
    except BaseException:
        index.unlink()
        raise
    return {'bytes': before.st_size, 'records': count, 'messages': messages,
            'oversized_messages': oversized, 'unclassified_records': unknown}


def search(db, query, limit):
    return db.execute(
        'SELECT record_id,timestamp,role,text FROM messages WHERE instr(text,?)>0 ORDER BY record_id DESC LIMIT ?',
        (query, limit),
    ).fetchall()


def export_record(source, destination, offset, length):
    with source.open('rb') as stream, destination.open('xb') as target:
        try:
            stream.seek(offset)
            remaining = length
            while remaining:
                part = stream.read(min(CHUNK, remaining))
                if not part:
                    raise EOFError('Archive ended before the indexed record')
                target.write(part)
                remaining -= len(part)
        except BaseException:
            target.close()
            destination.unlink()
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path, help='Folder containing frozen original.jsonl')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('index', help='Create a new index; existing indexes are never overwritten')
    find = sub.add_parser('search')
    find.add_argument('query')
    find.add_argument('--limit', type=int, default=8)
    show = sub.add_parser('show')
    show.add_argument('record', type=int)
    show.add_argument('--chars', type=int, default=8000)
    export = sub.add_parser('export')
    export.add_argument('record', type=int)
    export.add_argument('destination', type=Path)
    args = parser.parse_args()
    archive = args.archive.resolve()
    if args.command == 'index':
        print(json.dumps(build_index(archive), ensure_ascii=False))
        return
    if args.command == 'search' and (not args.query.strip() or not 1 <= args.limit <= 30):
        parser.error('Use a nonempty query and a limit between 1 and 30')
    with closing(sqlite3.connect((archive / 'cold-index.sqlite').as_uri() + '?mode=ro', uri=True)) as db:
        end = db.execute('SELECT offset+length FROM records ORDER BY id DESC LIMIT 1').fetchone()
        if not end or end[0] != (archive / 'original.jsonl').stat().st_size:
            raise ValueError('Archive size differs from its index; inspect the archive before rebuilding')
        if args.command == 'search':
            for record, stamp, role, message in search(db, args.query, args.limit):
                position = message.find(args.query)
                excerpt = message[max(0, position - 150):position + 650]
                print(json.dumps({'record': record, 'timestamp': stamp, 'role': role, 'excerpt': excerpt}, ensure_ascii=False))
            return
        row = db.execute('SELECT offset,length,timestamp,kind,subtype FROM records WHERE id=?', (args.record,)).fetchone()
        if not row:
            parser.error('Record not found')
        offset, length, stamp, kind, subtype = row
        if args.command == 'show':
            message = db.execute('SELECT role,text FROM messages WHERE record_id=?', (args.record,)).fetchone()
            result = {'record': args.record, 'timestamp': stamp, 'kind': kind, 'subtype': subtype, 'bytes': length}
            if message:
                selected = message[1][:max(1, min(args.chars, 30000))]
                result.update(role=message[0], text=selected, truncated=len(selected) < len(message[1]), text_chars_total=len(message[1]))
            else:
                result['note'] = 'Use export for the exact original record; absence from search does not mean absence from the archive.'
            print(json.dumps(result, ensure_ascii=False))
        else:
            export_record(archive / 'original.jsonl', args.destination, offset, length)
            print(str(args.destination.resolve()))


if __name__ == '__main__':
    main()
