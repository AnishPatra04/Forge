export const SAMPLE_PROJECT_FILES = [
  {
    id: 'sample-auth-ts',
    name: 'authService.ts',
    path: 'authService.ts',
    extension: '.ts',
    size: 2140,
    lineCount: 68,
    lastModified: Date.now() - 3600000 * 2,
    content: `import { jwtVerify, SignJWT } from 'jose';

export interface UserSession {
  id: string;
  email: string;
  role: 'admin' | 'developer' | 'viewer';
  permissions: string[];
}

export class AuthService {
  private readonly secretKey: Uint8Array;
  private readonly tokenExpiration: string = '24h';

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error('AUTH_ERR: Secret key must be at least 32 characters long.');
    }
    this.secretKey = new TextEncoder().encode(secret);
  }

  /**
   * Generates a signed JWT session token for an authenticated user.
   */
  async createSessionToken(user: UserSession): Promise<string> {
    return new SignJWT({
      sub: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.tokenExpiration)
      .sign(this.secretKey);
  }

  /**
   * Verifies an incoming authorization header token.
   */
  async verifySessionToken(token: string): Promise<UserSession | null> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey, {
        algorithms: ['HS256'],
      });

      return {
        id: payload.sub as string,
        email: payload.email as string,
        role: payload.role as 'admin' | 'developer' | 'viewer',
        permissions: (payload.permissions as string[]) || [],
      };
    } catch (err) {
      console.error('Session verification failed:', err);
      return null;
    }
  }

  /**
   * Checks whether a user holds required role permission.
   */
  hasPermission(session: UserSession, requiredPerm: string): boolean {
    if (session.role === 'admin') return true;
    return session.permissions.includes(requiredPerm);
  }
}`
  },
  {
    id: 'sample-api-js',
    name: 'apiClient.js',
    path: 'apiClient.js',
    extension: '.js',
    size: 1820,
    lineCount: 54,
    lastModified: Date.now() - 3600000 * 4,
    content: `// FORGE REST Client with automatic retry & exponential backoff
const BASE_URL = process.env.API_BASE_URL || 'https://api.forge.local/v1';

export async function fetchWithRetry(endpoint, options = {}, retries = 3) {
  const url = \`\${BASE_URL}\${endpoint}\`;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...defaultHeaders, ...options.headers },
      });

      if (!response.ok) {
        if (response.status >= 500 && attempt < retries) {
          const delay = Math.pow(2, attempt) * 200;
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }
        throw new Error(\`Request failed with status \${response.status}: \${response.statusText}\`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries) {
        throw new Error(\`Network error after \${retries} attempts: \${error.message}\`);
      }
      await new Promise((res) => setTimeout(res, 300 * attempt));
    }
  }
}

export const CodebaseAPI = {
  getProject: (id) => fetchWithRetry(\`/projects/\${id}\`),
  getFiles: (id) => fetchWithRetry(\`/projects/\${id}/files\`),
  indexCodebase: (id) => fetchWithRetry(\`/projects/\${id}/index\`, { method: 'POST' }),
};`
  },
  {
    id: 'sample-db-py',
    name: 'database.py',
    path: 'database.py',
    extension: '.py',
    size: 2450,
    lineCount: 65,
    lastModified: Date.now() - 3600000 * 8,
    content: `"""
Database Connection & Session Pool Manager
Handles Postgres connection lifecycle and query execution.
"""
import os
import logging
from contextlib import contextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger("forge.database")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://forge:secret@localhost:5432/forge_db")

engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    echo=False
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

@contextmanager
def get_db_session():
    """Context manager for safe database transaction handling."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception as exc:
        session.rollback()
        logger.error(f"Database transaction error: {exc}")
        raise exc
    finally:
        session.close()

def ping_database() -> bool:
    """Verifies that the database pool is active and answering queries."""
    try:
        with engine.connect() as connection:
            connection.execute("SELECT 1")
        return True
    except Exception as err:
        logger.warning(f"Database health check failed: {err}")
        return False
`
  },
  {
    id: 'sample-config-json',
    name: 'forge.config.json',
    path: 'forge.config.json',
    extension: '.json',
    size: 610,
    lineCount: 22,
    lastModified: Date.now() - 3600000 * 12,
    content: `{
  "project": "Forge Core Engine",
  "version": "0.1.0",
  "indexing": {
    "maxFileSizeKb": 1024,
    "excludeDirectories": ["node_modules", "dist", ".git", "__pycache__"],
    "supportedLanguages": ["javascript", "typescript", "python", "java"]
  },
  "features": {
    "localCodeSearch": true,
    "astSymbolExtraction": false,
    "vectorEmbeddings": false,
    "llmAssistant": false
  },
  "telemetry": {
    "enabled": false
  }
}`
  },
  {
    id: 'sample-readme-md',
    name: 'README.md',
    path: 'README.md',
    extension: '.md',
    size: 1420,
    lineCount: 42,
    lastModified: Date.now() - 3600000 * 18,
    content: `# Forge Core Architecture

FORGE is a developer tool engineered to accelerate codebase comprehension.

## Architecture Highlights
- **Fast Client Ingestion**: Ingests files into memory with fast lexical search.
- **Local Keyword Search**: Inspect identifiers, functions, and imports across all code.
- **Modular Pipeline**: Clean separation between storage, search, and UI state.

## Planned Milestones
1. Milestone 1: Client-side workspace and file inspector.
2. Milestone 2: Abstract Syntax Tree (AST) parsing and local embeddings.
3. Milestone 3: High-context LLM assistant and interview prep generator.
`
  }
];
