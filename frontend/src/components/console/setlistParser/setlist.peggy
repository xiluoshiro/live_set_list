{
  function lineOf() {
    return location().start.line;
  }

  function text(value) {
    return value.join("");
  }
}

Start
  = lines:Line* EndOfInput {
      return lines.filter((line) => line !== null);
    }

Line
  = PerformerLine
  / SongLine
  / BlankLine
  / UnknownLine

PerformerLine
  = _ open:("<" / "＜") value:BracketText close:(">" / "＞") _ NewLine? {
      return { type: "performer_context", text: text(value).trim(), line: lineOf() };
    }

SongLine
  = _ segment:("OP" / "WEN" / "EN" / "RH" / "M") order:Digits ("." / " ") _ name:LineText NewLine? {
      return {
        type: "song_entry",
        segmentType: segment,
        segmentOrder: Number(text(order)),
        songName: text(name).trim(),
        line: lineOf(),
      };
    }

BlankLine
  = _ NewLine {
      return null;
    }

UnknownLine
  = value:NonEmptyLineText NewLine? {
      return { type: "unknown_line", text: text(value).trim(), line: lineOf() };
    }

BracketText
  = chars:(!(">" / "＞" / NewLine / EndOfInput) .)* { return chars.map((item) => item[1]); }

LineText
  = chars:(!(NewLine / EndOfInput) .)* { return chars.map((item) => item[1]); }

NonEmptyLineText
  = chars:(!(NewLine / EndOfInput) .)+ { return chars.map((item) => item[1]); }

Digits
  = [0-9]+

_
  = [ \t]*

NewLine
  = "\r\n" / "\n" / "\r"

EndOfInput
  = !.
