package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/spf13/afero"

	"zakirullin/stuffbot/config"
	"zakirullin/stuffbot/internal/fs"
)

const (
	TokenLength        = 32
	OneTimeTokenExpiry = 10 * time.Minute
)

var (
	oneTimeTokens = make(map[string]oneTimeToken)
	mu            sync.RWMutex
)

type oneTimeToken struct {
	userID    int64
	expiresAt time.Time
}

func GenOneTimeToken(userID int64) string {
	token := genToken()

	mu.Lock()
	oneTimeTokens[token] = oneTimeToken{
		userID:    userID,
		expiresAt: time.Now().Add(OneTimeTokenExpiry),
	}
	mu.Unlock()

	return token
}

func FindUserID(token string) (int64, bool) {
	tokens, err := fs.NewFS(config.BotCfg.TokensDir, afero.NewOsFs())
	if err != nil {
		slog.Error("Failed to create file system for tokens", "error", err)
		return 0, false
	}

	data, err := tokens.Read(fs.DirRoot, token)
	if err != nil {
		return 0, false
	}

	userID, err := strconv.ParseInt(data, 10, 64)
	if err != nil {
		return 0, false
	}

	return userID, true
}

func IssueToken(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC in IssueToken: %v", r)
			http.Error(w, "Internal server error", 500)
		}
	}()

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		OneTimeToken string `json:"oneTimeToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	permanentToken, ok := issueNewToken(req.OneTimeToken)
	if !ok {
		http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	err := json.NewEncoder(w).Encode(map[string]string{"token": permanentToken})
	if err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

func issueNewToken(oneTimeToken string) (string, bool) {
	mu.Lock()
	data, exists := oneTimeTokens[oneTimeToken]
	if !exists || time.Now().After(data.expiresAt) {
		mu.Unlock()
		return "", false
	}
	delete(oneTimeTokens, oneTimeToken)
	mu.Unlock()

	token := genToken()
	tokens, err := fs.NewFS(config.BotCfg.TokensDir, afero.NewOsFs())
	if err != nil {
		slog.Error("Failed to create file system for tokens", "error", err)
		return "", false
	}
	err = tokens.Write(fs.DirRoot, token, strconv.FormatInt(data.userID, 10))
	if err != nil {
		return "", false
	}

	return token, true
}

func genToken() string {
	bytes := make([]byte, TokenLength)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
