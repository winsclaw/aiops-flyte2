package downloader

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	corev1 "k8s.io/api/core/v1"
)

const (
	EnvName      = "AIONE_PARAMS"
	SecretKey    = "aione_params"
	DefaultImage = "aione-downloader:latest"
)

type Code struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	Token  string `json:"token,omitempty"`
	Branch string `json:"branch,omitempty"`
}

type OSSData struct {
	Endpoint   string `json:"endpoint"`
	Port       string `json:"port"`
	AccessKey  string `json:"accessKey"`
	SecretKey  string `json:"secretKey"`
	TargetPath string `json:"targetPath"`
	Bucket     string `json:"bucket"`
	BucketPath string `json:"bucketPath,omitempty"`
}

type Params struct {
	Codes    []Code    `json:"codes"`
	OSSDatas []OSSData `json:"ossDatas"`
}

func SecretValue(params Params) ([]byte, error) {
	if params.Codes == nil {
		params.Codes = []Code{}
	}
	if params.OSSDatas == nil {
		params.OSSDatas = []OSSData{}
	}
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal downloader params: %w", err)
	}
	return []byte(base64.StdEncoding.EncodeToString(raw)), nil
}

func EnvVar(secretName string) corev1.EnvVar {
	return corev1.EnvVar{
		Name: EnvName,
		ValueFrom: &corev1.EnvVarSource{
			SecretKeyRef: &corev1.SecretKeySelector{
				LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
				Key:                  SecretKey,
			},
		},
	}
}

func Image(image string) string {
	if image == "" {
		return DefaultImage
	}
	return image
}
