export type ParsedSetlistLine =
  | {
      type: "performer_context";
      text: string;
      line: number;
    }
  | {
      type: "song_entry";
      segmentType: "M" | "OP" | "ED" | "EN" | "WEN" | "SP";
      segmentOrder: number;
      songName: string;
      line: number;
    }
  | {
      type: "unknown_line";
      text: string;
      line: number;
    };

export function parse(input: string): ParsedSetlistLine[];
