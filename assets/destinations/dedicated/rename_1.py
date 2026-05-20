import os

FOLDER = "pexels"

def main():
    if not os.path.isdir(FOLDER):
        print(f"ERROR: Folder not found -> {FOLDER}")
        return

    for filename in os.listdir(FOLDER):
        filepath = os.path.join(FOLDER, filename)

        if not os.path.isfile(filepath):
            continue

        if "-" not in filename:
            continue

        os.remove(filepath)
        print(f"DELETED: {filename}")

if __name__ == "__main__":
    main()