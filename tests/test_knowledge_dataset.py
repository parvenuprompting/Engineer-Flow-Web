from scripts.validate_knowledge_dataset import validate


def test_knowledge_dataset_is_valid() -> None:
    assert validate() == []
