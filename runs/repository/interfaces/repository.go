package interfaces

type Repository interface {
	ActionRepo() ActionRepo
	TaskRepo() TaskRepo
	TriggerRepo() TriggerRepo
	TrainingTaskRepo() TrainingTaskRepo
	DevelopmentInstanceRepo() DevelopmentInstanceRepo
	CloudStorageRepo() CloudStorageRepo
	CodeRepositoryRepo() CodeRepositoryRepo
}
