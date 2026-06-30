package models

import "encoding/json"

type RuntimeDataset struct {
	Endpoint            string `json:"endpoint"`
	Port                string `json:"port"`
	AccessKey           string `json:"accessKey"`
	SecretKeyCiphertext string `json:"secretKeyCiphertext,omitempty"`
	TargetPath          string `json:"targetPath"`
	Bucket              string `json:"bucket"`
	BucketPath          string `json:"bucketPath,omitempty"`
}

type DatasetMount struct {
	DatasetID  string `json:"datasetId"`
	TargetPath string `json:"targetPath"`
}

func DecodeRuntimeDatasets(value string) ([]RuntimeDataset, error) {
	if value == "" {
		return nil, nil
	}
	var datasets []RuntimeDataset
	if err := json.Unmarshal([]byte(value), &datasets); err != nil {
		return nil, err
	}
	return datasets, nil
}

func EncodeRuntimeDatasets(datasets []RuntimeDataset) (string, error) {
	if len(datasets) == 0 {
		return "[]", nil
	}
	data, err := json.Marshal(datasets)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func DecodeDatasetMounts(value string) ([]DatasetMount, error) {
	if value == "" {
		return nil, nil
	}
	var mounts []DatasetMount
	if err := json.Unmarshal([]byte(value), &mounts); err != nil {
		return nil, err
	}
	return mounts, nil
}

func EncodeDatasetMounts(mounts []DatasetMount) (string, error) {
	if len(mounts) == 0 {
		return "[]", nil
	}
	data, err := json.Marshal(mounts)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
