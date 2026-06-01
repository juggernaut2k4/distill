#!/usr/bin/env bash
# setup-claude-skills.sh
# Installs Claude Code skills for the distill / Clio AI dev workflow.
# Run: bash setup-claude-skills.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
step() { echo -e "\n${YELLOW}▶ $1${NC}"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Claude Code Skills Setup — distill / Clio AI"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Prerequisites ────────────────────────────────────────────────────────────

step "Checking prerequisites"

command -v git  >/dev/null 2>&1 || fail "git is required. Install from https://git-scm.com"
ok "git found: $(git --version)"

command -v node >/dev/null 2>&1 || fail "Node.js is required. Install from https://nodejs.org"
ok "node found: $(node --version)"

command -v npx  >/dev/null 2>&1 || fail "npx is required (comes with Node.js 5.2+)"
ok "npx found"

command -v claude >/dev/null 2>&1 || fail "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
ok "claude CLI found"

# bun — required by gstack
if ! command -v bun >/dev/null 2>&1; then
  step "Installing bun (required by gstack)"
  curl -fsSL https://bun.sh/install | bash
  # Add bun to PATH for this session
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  ok "bun installed: $(bun --version)"
else
  ok "bun found: $(bun --version)"
fi

# ─── 1. ruflo ─────────────────────────────────────────────────────────────────

step "Installing ruflo (multi-agent orchestration)"

if npm list -g ruflo >/dev/null 2>&1; then
  warn "ruflo already installed globally — skipping npm install"
else
  npm install -g ruflo@latest
  ok "ruflo installed: $(npx ruflo@latest --version 2>/dev/null || echo 'latest')"
fi

# Register ruflo as an MCP server with Claude
if claude mcp list 2>/dev/null | grep -q "ruflo"; then
  warn "ruflo already registered as MCP server — skipping"
else
  claude mcp add ruflo -- npx ruflo@latest mcp start
  ok "ruflo registered as Claude MCP server"
fi

# ─── 2. gstack ────────────────────────────────────────────────────────────────

step "Installing gstack (virtual engineering team)"

GSTACK_DIR="$HOME/.claude/skills/gstack"

if [ -d "$GSTACK_DIR" ]; then
  warn "gstack already installed at $GSTACK_DIR — pulling latest"
  git -C "$GSTACK_DIR" pull --ff-only
else
  mkdir -p "$HOME/.claude/skills"
  git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git "$GSTACK_DIR"
  ok "gstack cloned to $GSTACK_DIR"
fi

cd "$GSTACK_DIR"
./setup
ok "gstack setup complete"
cd - >/dev/null

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  All skills installed successfully!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Available slash commands:"
echo ""
echo "  ruflo (MCP — active automatically in Claude sessions)"
echo "    → Multi-agent orchestration for complex tasks"
echo ""
echo "  gstack"
echo "    /review            Code review by engineering team"
echo "    /qa                QA pass before shipping"
echo "    /design-html       Frontend design review"
echo "    /cso               Security audit (OWASP, webhooks)"
echo "    /ship              End-to-end ship pipeline"
echo "    /plan-ceo-review   Product/strategy review"
echo "    /plan-eng-review   Technical architecture review"
echo "    /browse            Browser automation"
echo "    /investigate       Deep-dive debugging"
echo "    /retro             Retrospective + lessons learned"
echo ""
echo "  Restart Claude Code to activate all skills."
echo ""
