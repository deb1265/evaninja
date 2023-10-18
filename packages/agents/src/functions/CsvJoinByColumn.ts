import { ScriptFunction } from "../scriptedAgents/ScriptFunction"

export class CsvJoinByColumnFunction extends ScriptFunction<{ csv1Path: string, csv2Path: string, joinColumnName: string }> {
  name: string = "csv_joinByColumn";
  description: string = "Join two CSVs by a shared column name";
  parameters: any = {
    type: "object",
    properties: { 
      csvData1: {
          type: "string"
      },
      csvData2: {
          type: "string"
      },
      joinColumnName: {
          type: "string"
      }
    },
    required: ["csvData1", "csvData2", "joinColumnName"],
    additionalProperties: false
  };
}