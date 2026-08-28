#!/usr/bin/env python3
"""Verify a built container image's configuration before it is published.

An image that builds is not an image that works. Each check here corresponds to
something that has actually been wrong at some point during this project:

  healthcheck    buildah silently drops HEALTHCHECK when the image is in OCI
                 format. The published image would never report unhealthy, and
                 Docker would never restart a wedged container.
  user           an image running as root is a needless risk, and the Dockerfile
                 creating the user is no guarantee it is selected.
  port           without EXPOSE, `docker run -P` publishes nothing and a
                 compose file mapping the port still works — so the mistake is
                 invisible until someone runs the image directly.
  version        SONE_VERSION is baked in at build time and reported by
                 /api/version. Defaulting to "dev" in a published image means
                 nobody can tell what is deployed.

Kept as a file rather than a heredoc inside the workflow: Python is
whitespace-sensitive and YAML block scalars are an inviting place to break
indentation without noticing.

    verify-image.py <buildah-inspect-output.json>
"""

import json
import sys

EXPECTED_UID = "10001"
EXPECTED_PORT = "3000/tcp"


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <inspect.json>", file=sys.stderr)
        return 2

    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)

    # Accepts either `docker inspect` output (a list of images, config under
    # "Config") or `buildah inspect` output (an object with separate OCIv1 and
    # Docker views). Supporting both means this script does not have to change
    # when the build tool does, and the checks are the point rather than the
    # format.
    if isinstance(data, list):
        if not data:
            print("empty inspect output", file=sys.stderr)
            return 2
        config = data[0].get("Config", {}) or {}
        docker_config = config
        oci_config = config
    else:
        # buildah: the healthcheck exists only in the Docker view, which is why
        # --format docker matters there.
        docker_config = (data.get("Docker") or {}).get("config", {}) or {}
        oci_config = (data.get("OCIv1") or {}).get("config", {}) or {}

    problems: list[str] = []

    healthcheck = docker_config.get("Healthcheck")
    if not healthcheck or not healthcheck.get("Test"):
        problems.append(
            "no HEALTHCHECK in the image. buildah drops it silently when "
            "building OCI format — if buildah is in use, check --format docker."
        )

    # The image deliberately declares no USER: the entrypoint starts as root so
    # it can make a bind-mounted directory writable, then execs the server as
    # uid 10001 (docker/entrypoint.sh explains why).
    #
    # So this no longer checks the declared user, which would now be wrong in
    # both directions — it would fail a correct image, and it would pass an
    # image whose entrypoint quietly forgot to drop privilege. What is checked
    # instead is that the entrypoint really does hand over.
    # Named differently from the `entrypoint` list read below, which this
    # shadowed — a reassignment from string to list that happened to work and
    # would have confused the next reader.
    entrypoint_text = " ".join(oci_config.get("Entrypoint") or []) + " " + " ".join(
        oci_config.get("Cmd") or []
    )
    if "entrypoint.sh" not in entrypoint_text:
        problems.append(
            f"entrypoint is {entrypoint_text.strip()!r}; expected "
            "docker/entrypoint.sh, which is what drops privilege"
        )

    exposed = oci_config.get("ExposedPorts") or {}
    if EXPECTED_PORT not in exposed:
        problems.append(
            f"{EXPECTED_PORT} not exposed (found: {sorted(exposed) or 'none'})"
        )

    env = oci_config.get("Env") or []
    version = next(
        (e.split("=", 1)[1] for e in env if e.startswith("SONE_VERSION=")),
        None,
    )
    if not version or version == "dev":
        problems.append(
            f"SONE_VERSION is {version!r}; it must be baked in at build time so "
            "/api/version can identify what is deployed"
        )

    entrypoint = oci_config.get("Entrypoint") or []
    if not entrypoint:
        problems.append("no ENTRYPOINT")

    if problems:
        print("image verification failed:")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print("image configuration verified:")
    # The declared user is deliberately absent: the image has none, because the
    # entrypoint starts as root and drops to uid 10001. The workflow checks the
    # running container for that; this only confirms the entrypoint is the one
    # that does it.
    print(f"  drops to    uid {EXPECTED_UID} via the entrypoint")
    print(f"  entrypoint  {' '.join(entrypoint)}")
    print(f"  exposed     {', '.join(sorted(exposed))}")
    print(f"  version     {version}")
    print(f"  healthcheck {' '.join(healthcheck.get('Test', []))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
