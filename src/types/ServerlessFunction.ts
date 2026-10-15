export interface ServerlessFunction {
  id: string;
  name: string;
  route: string; // e.g. "/api/my-function"
  code: string;
  created_at: string;
  version?: string; // Add version to the interface
}