package interfaces

type Repository interface {
	ActionRepo() ActionRepo
	TaskRepo() TaskRepo
	TriggerRepo() TriggerRepo
	TrainingTaskRepo() TrainingTaskRepo
	CloudStorageRepo() CloudStorageRepo
}
