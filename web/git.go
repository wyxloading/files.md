package main

import (
	"log"
	"net/http"

	"github.com/AaronO/go-git-http"
)

// CORSMiddleware wraps an http.Handler and adds CORS headers to the response
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "300")

		// Handle preflight OPTIONS requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// Call the next handler
		next.ServeHTTP(w, r)
	})
}

func main2() {
	// Get git handler to serve a directory of repos
	git := githttp.New("/tmp/repo")

	// Wrap git handler with CORS middleware
	corsHandler := CORSMiddleware(git)

	// Attach handler to http server
	http.Handle("/", corsHandler)

	// Start HTTP server
	log.Println("Starting Git HTTP server with CORS support on :8080")
	err := http.ListenAndServe(":8080", nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
