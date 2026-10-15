export interface EnvVar {
  id: string;
  key: string;
  value: string;
}

export interface Project {
  id: string;
  name: string;
  framework: string; // 'nextjs' | 'react' | 'svelte' | 'serverless' | 'static'
  repo: string;
  branch: string;
  createdAt: string;
  activeDeploymentId: string;
  domains: string[];
  env: EnvVar[];
}

export interface Deployment {
  id: string;
  projectId: string;
  status: 'building' | 'ready' | 'failed';
  previewUrl: string;
  createdAt: string;
  commitMessage: string;
  commitHash: string;
  buildLogs: string[];
  deployedHtml?: string; // High-fidelity visual mockup layout
}

export interface ServerlessFunction {
  id: string;
  projectId: string;
  name: string; // e.g. "analyze-sentiment", "generate-image", "hello"
  route: string; // e.g. "/api/analyze-sentiment"
  code: string;  // JS/TS representation
  description: string;
}

export interface FunctionExecutionLog {
  id: string;
  functionId: string;
  timestamp: string;
  status: number;
  durationMs: number;
  memoryMb: number;
  stdout: string[];
  responseBody: string;
}

export interface AnalyticsMetric {
  timestamp: string;
  requests: number;
  bandwidth: number; // in MB
  errors: number; // count
  latency: number; // in ms
  successRate?: number; // New: Agent success rate (percentage)
  agentErrors?: number; // New: Agent specific error rate (percentage)
  agentLatency?: number; // New: Agent specific average latency (in ms)
}

export interface CoreWebVitals {
  lcp: { value: number; rating: 'good' | 'needs-improvement' | 'poor' | 'measuring' };
  fid: { value: number; rating: 'good' | 'needs-improvement' | 'poor' | 'measuring' };
  cls: { value: number; rating: 'good' | 'needs-improvement' | 'poor' | 'measuring' };
}

export interface ShieldConfig {
  sslMode: 'flexible' | 'strict' | 'full' | 'off';
  developmentMode: boolean;
  brotli: boolean;
  securityLevel: 'off' | 'low' | 'medium' | 'high' | 'under-attack';
  totalThreatsBlocked: number;
  wafRules: WafRule[];
}

export interface WafRule {
  id: string;
  field: 'ip' | 'country' | 'user_agent' | 'uri';
  operator: 'eq' | 'ne' | 'contains' | 'starts_with';
  value: string;
  action: 'block' | 'challenge' | 'allow';
  isEnabled: boolean;
}

export interface ThreatIncident {
  id: string;
  timestamp: string;
  ip: string;
  country: string;
  flag: string;
  threatType: string;
  action: 'blocked' | 'challenged' | 'allowed';
  query: string;
}

export interface DbColumn {
  name: string;
  type: 'text' | 'integer' | 'uuid' | 'boolean' | 'timestamp';
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string;
}

export interface DbTable<T = Record<string, any>> { // Using a generic type parameter for better type safety
  id: string;
  name: string;
  columns: DbColumn[];
  rows: T[];
}

export interface AuthConfig {
  jwtLifespan: number;
  allowSignup: boolean;
  passwordMinLength: number;
  providers: {
    emailPassword: boolean;
    magicLink: boolean;
    otp: boolean;
  };
  redirectUrls: string[];
}

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
  lastLogin: string;
  status: 'active' | 'suspended';
  /** Workspace role for this user. Optional for backwards compatibility with older stored state. */
  role?: 'admin' | 'member' | 'viewer';
}

export interface ApiKey {
  id: string;
  name: string;
  secret: string;
  createdAt: string;
  rateLimit: number;
  description: string
}

export interface ComposioConnector {
  id: string;
  name: string;
  category: string;
  description: string;
  isConnected?: boolean;
  scopesCount?: number;
}

export interface WorkspaceMember {
  email: string;
  role: string;
}

export interface Workspace {
  id: string;
  name: string;
  owner: string;
  members: WorkspaceMember[];
}
