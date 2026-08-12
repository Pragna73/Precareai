import csv
import random

random.seed(42)

rows = []

for i in range(1, 301):

    age = random.randint(18, 40)
    gestational_age = random.randint(4, 40)

    hemoglobin = round(random.uniform(7.0, 14.5), 1)

    systolic = random.randint(90, 170)
    diastolic = random.randint(55, 110)

    fetal_heart_rate = random.randint(110, 180)

    platelet = round(random.uniform(0.8, 3.5), 2)

    glucose = random.randint(60, 180)

    urine_protein = random.choice(
        ["Negative", "Trace", "1+", "2+", "3+"]
    )

    rows.append({
        "case_id": f"CASE-{i:03d}",
        "patient_name": f"Test Patient {i:03d}",
        "age": age,
        "gestational_age": gestational_age,
        "hemoglobin": hemoglobin,
        "systolic": systolic,
        "diastolic": diastolic,
        "fetal_heart_rate": fetal_heart_rate,
        "platelet": platelet,
        "glucose": glucose,
        "urine_protein": urine_protein
    })


with open(
    "test_data/pregnancy_test_cases.csv",
    "w",
    newline=""
) as file:

    writer = csv.DictWriter(
        file,
        fieldnames=rows[0].keys()
    )

    writer.writeheader()
    writer.writerows(rows)

print("Generated 300 synthetic pregnancy test cases.")
