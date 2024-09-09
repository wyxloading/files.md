package config

import (
	"fmt"

	"github.com/kelseyhightower/envconfig"
)

type GUIConfig struct {
	ConfigFilename     string `default:"config.json"`
	GUIUserStoragePath string `default:"." envconfig:"GUI_USER_STORAGE_PATH"`
}

var GUICfg GUIConfig

func LoadGUIConfig() error {
	if err := envconfig.Process("", &GUICfg); err != nil {
		return fmt.Errorf("can't load config: %w", err)
	}

	return nil
}
