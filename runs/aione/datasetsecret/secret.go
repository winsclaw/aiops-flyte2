package datasetsecret

import (
	"crypto/aes"
	"crypto/cipher"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"strings"
)

func Encrypt(secret string) (string, error) {
	block, err := aes.NewCipher(secretKey())
	if err != nil {
		return "", fmt.Errorf("failed to initialize dataset secret encryption: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to initialize dataset secret encryption: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(crand.Reader, nonce); err != nil {
		return "", fmt.Errorf("failed to generate dataset secret nonce: %w", err)
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(secret), nil)
	return "v1:" + base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func Decrypt(ciphertext string) (string, error) {
	value := strings.TrimSpace(ciphertext)
	if !strings.HasPrefix(value, "v1:") {
		return "", fmt.Errorf("unsupported dataset secret ciphertext format")
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(value, "v1:"))
	if err != nil {
		return "", fmt.Errorf("failed to decode dataset secret ciphertext: %w", err)
	}
	block, err := aes.NewCipher(secretKey())
	if err != nil {
		return "", fmt.Errorf("failed to initialize dataset secret encryption: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to initialize dataset secret encryption: %w", err)
	}
	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("dataset secret ciphertext is too short")
	}
	nonce := raw[:gcm.NonceSize()]
	encrypted := raw[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt dataset secret: %w", err)
	}
	return string(plaintext), nil
}

func secretKey() []byte {
	seed := strings.TrimSpace(os.Getenv("AIONE_DATASET_SECRET_KEY"))
	if seed == "" {
		seed = "aione-dataset-secret-key"
	}
	sum := sha256.Sum256([]byte(seed))
	return sum[:]
}
