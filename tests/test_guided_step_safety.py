from scripts.validate_guided_step_safety import validate


def test_all_guided_steps_have_safety_metadata() -> None:
    assert validate() == []
