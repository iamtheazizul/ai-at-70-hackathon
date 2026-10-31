# Claude Managed Agents quickstart

This directory is a standalone [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/quickstart) example. It is separate from the Shoptimal shopping MVP, which has no language model.

## Setup

```bash
brew install anthropics/tap/ant
ant --version

cd managed-agent
python3 -m venv .venv
source .venv/bin/activate
pip install anthropic
export ANTHROPIC_API_KEY="your-api-key-here"
```

Do not commit the API key. `.venv/` is local only.

## Apply and run

From this directory:

```bash
ant apply coding-assistant.md environment.yaml
python start_session.py
```

`ant apply` writes `claude-lock.json` with the agent and environment IDs. `start_session.py` reads that file, opens a session titled "Quickstart session", and asks the agent to create a Python script that generates the first 20 Fibonacci numbers and saves them to `fibonacci.txt`.

In a non-interactive shell, `ant apply` cannot prompt for confirmation. Re-run with `--yes`:

```bash
ant apply --yes coding-assistant.md environment.yaml
```
