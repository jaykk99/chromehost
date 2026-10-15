# Operational Protocols for AI Assistant

To prevent software lockups, execution loops, or hanging states, the following operational protocols MUST be strictly adhered to:

1. **ONE TOOL PER TURN**: Never attempt to execute multiple MCP tool calls simultaneously or in a single response turn.
2. **EXPLICIT PARAMETERS**: Before executing any tool, explicitly verify that all required software arguments and absolute file paths are fully defined. Never guess or pass null/empty variables to a tool call.
3. **PRE-FLIGHT REASONING**: Before calling a tool, output a single short sentence explaining exactly WHY you are calling it and WHAT software outcome you expect.
4. **LOOP DETECTION & TIMEOUT**: If a tool call fails, returns an error, or returns the exact same data as a previous turn, you are entering a loop. Stop immediately. Do not retry the tool. State: "SOFTWARE LOOP DETECTED: Manual intervention required."
5. **NO HALLUCINATED TOOLS**: Only call software tools that are explicitly exposed in your active MCP schema definition. If a required capability is missing, stop and inform the user.
