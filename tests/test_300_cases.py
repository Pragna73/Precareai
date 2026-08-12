import csv
from pathlib import Path

import pytest


BASE_URL = "https://precareai-five.vercel.app/"


CSV_FILE = (
    Path(__file__).resolve().parent.parent
    / "test_data"
    / "pregnancy_test_cases_300.csv"
)


def load_test_cases():
    with CSV_FILE.open(newline="", encoding="utf-8") as file:
        return list(csv.DictReader(file))


test_cases = load_test_cases()


@pytest.mark.parametrize(
    "case",
    test_cases,
    ids=[case["case_id"] for case in test_cases],
)
def test_pregnancy_case(case, driver):
    driver.get(BASE_URL)

    assert driver.current_url.startswith(BASE_URL)

    assert "PreCare" in driver.page_source

    print(
        f"Testing {case['case_id']}: "
        f"Age={case['age']}, "
        f"GestationalAge={case['gestational_age']}, "
        f"Hb={case['hemoglobin']}, "
        f"BP={case['systolic']}/{case['diastolic']}, "
        f"FHR={case['fetal_heart_rate']}"
    )
