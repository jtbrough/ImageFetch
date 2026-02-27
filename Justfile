run:
	node server.js

docker-build:
	docker build --pull --no-cache -t imagefetch:latest .

docker-run:
	docker run --rm \
		--name ImageFetch \
		-p 8788:8788 \
		--tmpfs /tmp:rw,noexec,nosuid,size=16m \
		--cap-drop=ALL \
		--security-opt no-new-privileges:true \
		--pids-limit 150 \
		imagefetch:latest

ci-lint:
	actionlint

ci-act-list:
	XDG_CACHE_HOME=/tmp ACT_CACHE_DIR=/tmp/act-cache act -l --container-architecture linux/amd64

ci-act-validate:
	XDG_CACHE_HOME=/tmp ACT_CACHE_DIR=/tmp/act-cache act pull_request -j validate --container-architecture linux/amd64 -P ubuntu-latest=ghcr.io/catthehacker/ubuntu:act-latest

ci-act-docker-build:
	XDG_CACHE_HOME=/tmp ACT_CACHE_DIR=/tmp/act-cache act pull_request -j docker-build --container-architecture linux/amd64 -P ubuntu-latest=ghcr.io/catthehacker/ubuntu:act-latest

ci-checks:
	just ci-lint
	just ci-act-validate
	just ci-act-docker-build
