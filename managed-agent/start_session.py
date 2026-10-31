"""Start the Claude Managed Agents quickstart session.

Reads ANTHROPIC_API_KEY from the environment and the agent and environment
IDs from claude-lock.json after `ant apply`.
"""

import json
import os
import sys
from pathlib import Path

from anthropic import Anthropic

PROMPT = (
    "Create a Python script that generates the first 20 Fibonacci numbers "
    "and saves them to fibonacci.txt"
)


def load_ids(lock_path: Path) -> tuple[str, str]:
    data = json.loads(lock_path.read_text())
    agent_id = None
    environment_id = None
    for path, resource in data.get("resources", {}).items():
        kind = resource.get("kind")
        resource_id = resource.get("id")
        normalized = path.replace("\\", "/")
        if kind == "agent" or normalized.endswith("coding-assistant.md"):
            agent_id = resource_id
        elif kind == "environment" or normalized.endswith("environment.yaml"):
            environment_id = resource_id
    if not agent_id or not environment_id:
        raise SystemExit(
            f"{lock_path} is missing an agent id or environment id. "
            "Run `ant apply coding-assistant.md environment.yaml` first."
        )
    return agent_id, environment_id


def main() -> None:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "ANTHROPIC_API_KEY is not set. Export it before creating a session.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    lock_path = Path(__file__).resolve().parent / "claude-lock.json"
    if not lock_path.is_file():
        print(
            f"Missing {lock_path.name}. Run `ant apply coding-assistant.md environment.yaml` first.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    agent_id, environment_id = load_ids(lock_path)
    client = Anthropic()

    session = client.beta.sessions.create(
        agent=agent_id,
        environment_id=environment_id,
        title="Quickstart session",
    )
    print(f"Session ID: {session.id}")

    with client.beta.sessions.events.stream(session.id) as stream:
        client.beta.sessions.events.send(
            session.id,
            events=[
                {
                    "type": "user.message",
                    "content": [{"type": "text", "text": PROMPT}],
                }
            ],
        )

        for event in stream:
            match event.type:
                case "agent.message":
                    for block in event.content:
                        if block.type == "text":
                            print(block.text, end="")
                case "agent.tool_use":
                    print(f"\n[Using tool: {event.name}]")
                case "session.status_idle":
                    print("\n\nAgent finished.")
                    break


if __name__ == "__main__":
    main()
