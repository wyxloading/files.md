package config

import (
	"fmt"

	"github.com/kelseyhightower/envconfig"
)

type BotConfig struct {
	StoragePath     string `required:"true" envconfig:"STORAGE_PATH"`
	BotAPIToken     string `required:"true" envconfig:"BOT_API_TOKEN"`
	ConfigFilename  string `default:"config.json"`
	HabitsHost      string `default:"" envconfig:"HABITS_HOST"`
	HabitsCertsPath string `default:"/tmp" envconfig:"HABITS_CERTS_PATH"`
}

var BotCfg BotConfig

func LoadBotConfig() error {
	if err := envconfig.Process("", &BotCfg); err != nil {
		return fmt.Errorf("can't load config: %w", err)
	}

	return nil
}
