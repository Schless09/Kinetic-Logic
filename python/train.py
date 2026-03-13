"""
Train: BC on (frame, sensor) -> action (next sensor).
Reads data/processed/manifest.parquet, trains a small policy, saves to data/models/.
"""
from __future__ import annotations

import sys
from pathlib import Path

import torch
from torch.utils.data import DataLoader, random_split

from config import MODELS, PROCESSED, ensure_dirs
from dataset import VLADataset, collate_batch
from models import BCPolicy

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
BATCH_SIZE = 32
EPOCHS = 10
LR = 1e-3
VAL_RATIO = 0.15
IMAGE_SIZE = (64, 64)


def main() -> None:
    ensure_dirs()
    manifest = PROCESSED / "manifest.parquet"
    if not manifest.exists():
        print("Run process.py first to create manifest.parquet")
        sys.exit(1)

    dataset = VLADataset(manifest, image_size=IMAGE_SIZE)
    n = len(dataset)
    n_val = max(1, int(n * VAL_RATIO))
    n_train = n - n_val
    train_ds, val_ds = random_split(dataset, [n_train, n_val], generator=torch.Generator().manual_seed(42))

    train_loader = DataLoader(
        train_ds,
        batch_size=min(BATCH_SIZE, n_train),
        shuffle=True,
        collate_fn=collate_batch,
        num_workers=0,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=min(BATCH_SIZE, n_val),
        shuffle=False,
        collate_fn=collate_batch,
        num_workers=0,
    )

    model = BCPolicy(image_size=IMAGE_SIZE, sensor_dim=6, hidden=128).to(DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=LR)
    criterion = torch.nn.MSELoss()

    for epoch in range(EPOCHS):
        model.train()
        train_loss = 0.0
        for imgs, sensors, actions in train_loader:
            imgs, sensors, actions = imgs.to(DEVICE), sensors.to(DEVICE), actions.to(DEVICE)
            opt.zero_grad()
            pred = model(imgs, sensors)
            loss = criterion(pred, actions)
            loss.backward()
            opt.step()
            train_loss += loss.item()
        train_loss /= len(train_loader)

        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for imgs, sensors, actions in val_loader:
                imgs, sensors, actions = imgs.to(DEVICE), sensors.to(DEVICE), actions.to(DEVICE)
                pred = model(imgs, sensors)
                val_loss += criterion(pred, actions).item()
        val_loss /= len(val_loader)
        print(f"Epoch {epoch + 1}/{EPOCHS}  train_loss={train_loss:.6f}  val_loss={val_loss:.6f}")

    out_path = MODELS / "bc_policy.pt"
    torch.save({"model": model.state_dict(), "image_size": IMAGE_SIZE, "sensor_dim": 6}, out_path)
    print(f"Saved model to {out_path}")


if __name__ == "__main__":
    main()
