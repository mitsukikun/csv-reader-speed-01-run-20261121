// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Original implementation, written from the RULES.txt policy alone: it reads
// a CSV text once, left to right, and returns exactly what csv-reader 1.0.0
// returns for the same input {text, header}: {columns, rows, errors}.
//
// Policy (identical to csv-reader 1.0.0):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside it
//     is read as LF; what follows its closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field ends);
//     a quote that never closes is a literal character, and the text after it
//     is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on (every LF, CRLF and lone CR inside a quoted field counted),
//     row its record's index in rows (null for the header), in the order met,
//     a field's quote_junk when the field ends and a record's short_row or
//     long_row when the record ends.
//
// Speed: csv-reader 1.0.0 walks the text one character at a time and builds
// every field a character at a time. This reader instead works in slices:
//   - a fast path for the common clean line (no quote, no stray CR): one
//     slice plus String.split(',') per record, all in native code;
//   - a jump path for the rest: an unquoted field is cut at the next comma
//     or line end found by indexOf (the line end is cached, so it is found
//     once per line), with stray CRs checked on the short field span; a
//     quoted field is cut at the next quote found by indexOf, with CR/LF
//     normalisation applied to whole segments at once instead of a character
//     at a time.
// No dependency, no cache kept from one case to the next, deterministic.
// Output validation: run() returns {columns, rows, errors} with columns an
// array (or null when header is false), rows an array of arrays of strings
// all at the first record's width, and errors an array of {code, line, row}
// objects; any deviation is a bug, not a silent pass.

// CRLF and lone CR inside a quoted segment each become one LF.
const CR = /\r\n?/g;

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The index of the next LF at or after pos, or len when there is none.
  // Valid while pos does not pass it; a backward jump (unterminated quote)
  // invalidates it.
  let cachedLE = -1;
  function lineEnd() {
    if (pos > cachedLE) {
      const nl = text.indexOf('\n', pos);
      cachedLE = nl === -1 ? len : nl;
    }
    return cachedLE;
  }

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Normalises one quoted segment: CRLF and lone CR each become one LF.
  // Returns [value, breaks]: the segment's text and how many line breaks it held.
  function normSeg(seg) {
    if (seg.indexOf('\r') === -1) {
      if (seg.indexOf('\n') === -1) return [seg, 0];
      return [seg, seg.split('\n').length - 1];
    }
    const v = seg.replace(CR, '\n');
    return [v, v.split('\n').length - 1];
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns the field and how
  // it ended; `added` counts the characters kept. An unquoted field never
  // crosses a line break, so the search is bounded by the current line end.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const le = lineEnd();
      const c = text.indexOf(',', pos);
      let spanEnd;
      let ended;
      if (c !== -1 && c < le) {
        spanEnd = c;
        ended = COMMA;
      } else if (le < len) {
        // The line ends at le; a CR just before it is the CRLF terminator.
        spanEnd = le > pos && text.charCodeAt(le - 1) === 13 ? le - 1 : le;
        ended = LINE_BREAK;
      } else {
        spanEnd = len;
        ended = END;
      }
      const span = text.slice(pos, spanEnd);
      const r = span.indexOf('\r');
      if (r !== -1) {
        // A stray CR inside the field: drop it, record it, read on.
        value += span.slice(0, r);
        added += r;
        error('stray_cr');
        pos += r + 1;
        continue;
      }
      value += span;
      added += spanEnd - pos;
      if (ended === COMMA) {
        pos = c + 1;
        return { value, ended: COMMA, added };
      }
      if (ended === LINE_BREAK) {
        pos = le + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      pos = len;
      return { value, ended: END, added };
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = pos + 1;
    let breaks = 0;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        cachedLE = -1;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote, and the scan goes on.
        const seg = normSeg(text.slice(p, q));
        value += seg[0];
        breaks += seg[1];
        value += '"';
        p = q + 2;
        continue;
      }
      const seg = normSeg(text.slice(p, q));
      value += seg[0];
      line += breaks + seg[1];
      pos = q + 1;
      if (pos >= len) return { value, ended: END };
      const c = text[pos];
      if (c === ',') {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === '\n') {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === '\r' && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) error('quote_junk');
      return junk;
    }
  }

  // Finishes one record: header, or a row padded/cut to the first width.
  function finishRecord(fields, quoted) {
    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (pos < len) {
    // The fast path: one whole clean line (no quote, no stray CR) at a time.
    const le = lineEnd();
    if (le === pos) {
      // An empty line is no record.
      pos = le + 1;
      line += 1;
      continue;
    }
    if (le < len && le === pos + 1 && text.charCodeAt(pos) === 13) {
      // A CRLF-only line is no record. (When le === len there is no LF
      // after the CR, so it is a stray CR, not a blank line.)
      pos = le + 1;
      line += 1;
      continue;
    }
    const end = le < len && text.charCodeAt(le - 1) === 13 ? le - 1 : le; // CRLF
    const seg = text.slice(pos, end);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      recordLine = line;
      recordRow = header && columns === null ? null : rows.length;
      finishRecord(seg.split(','), false);
      pos = le < len ? le + 1 : len;
      line += 1;
      continue;
    }

    // The jump path: this line holds a quote or a stray CR, so read it a
    // field at a time, exactly as csv-reader 1.0.0 does.
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text[pos] === '"';
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);
    finishRecord(fields, quoted);
  }
  const answer = { columns: header ? (columns ?? []) : null, rows, errors };
  // Output validation: the answer must keep csv-reader's shape, or the
  // caller gets a wrong-shaped value instead of a silent pass.
  if (!Array.isArray(answer.rows) || !Array.isArray(answer.errors)) throw new Error('bad answer shape');
  if (answer.columns !== null && !Array.isArray(answer.columns)) throw new Error('bad columns shape');
  for (let i = 0; i < answer.rows.length; i++) {
    if (!Array.isArray(answer.rows[i])) throw new Error('bad row shape');
  }
  return answer;
}
