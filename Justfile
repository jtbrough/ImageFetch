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
