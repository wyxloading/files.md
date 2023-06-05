run:
	cd cmd && go run .

test:
	go test ./...

install:
	go get ./...