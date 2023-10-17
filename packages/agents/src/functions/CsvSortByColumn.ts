import { ScriptFunction } from "../scriptedAgents/ScriptFunction"

export class CsvSortByColumnFunction extends ScriptFunction<{ csvData: string, columnIndex: string }> {
  name: string = "csv_sortByColumn";
  description: string = "Sort a column in a CSV";
  parameters: any = {
    type: "object",
    properties: { 
      csvData: {
          type: "string"
      },
      columnIndex: {
          type: "number"
      }
    },
    required: ["csvData", "columnIndex"],
    additionalProperties: false
  };
}
