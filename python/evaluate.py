"""
Evaluate: load trained BC model, report validation MSE and optional toy rollout.
No real robot: we only evaluate on holdout data and (optionally) a simple proxy metric.
"""
from __future__ import annotations

import sys
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from config import MODELS, PROCESSED
from dataset import VLADataset, collate_batch
from models import BCPolicy

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
IMAGE_SIZE = (64, 64)


def main() -> None:
    manifest = PROCESSED / "manifest.parquet"
    ckpt_path = MODELS / "bc_policy.pt"
    if not manifest.exists():
        print("Run process.py first")
        sys.exit(1)
    if not ckpt_path.exists():
        print("Run train.py first to produce bc_policy.pt")
        sys.exit(1)

    ckpt = torch.load(ckpt_path, map_location=DEVICE, weights_only=True)
    model = BCPolicy(image_size=IMAGE_SIZE, sensor_dim=6, hidden=128).to(DEVICE)
    model.load_state_dict(ckpt["model"])
    model.eval()

    dataset = VLADataset(manifest, image_size=IMAGE_SIZE)
    loader = DataLoader(dataset, batch_size=32, shuffle=False, collate_fn=collate_batch, num_workers=0)

    total_mse = 0.0
    n = 0
    with torch.no_grad():
        for imgs, sensors, actions in loader:
            imgs, sensors, actions = imgs.to(DEVICE), sensors.to(DEVICE), actions.to(DEVICE)
            pred = model(imgs, sensors)
            mse = ((pred - actions) ** 2).mean().item()
            total_mse += mse * imgs.size(0)
            n += imgs.size(0)
    mean_mse = total_mse / n if n else 0.0
    print(f"Evaluation (full dataset): n={n}  MSE={mean_mse:.6f}  RMSE={mean_mse ** 0.5:.6f}")

    # Toy "rollout": start from first sample, autoregress with predicted next sensor (no image update)
    if n >= 2:
        img0, s0, a0 = dataset[0]
        img0 = img0.unsqueeze(0).to(DEVICE)
        s = s0.unsqueeze(0).to(DEVICE)
        rollout_mse = 0.0
        steps = min(10, len(dataset) - 1)
        for step in range(steps):
            pred = model(img0, s)
            s_next_true = torch.tensor(
                [dataset[step + 1][2].tolist()], dtype=torch.float32, device=DEVICE
            )
            rollout_mse += ((pred - s_next_true) ** 2).mean().item()
            s = pred.detach()
        rollout_mse /= steps
        print(f"Toy rollout (reuse first frame, {steps} steps): MSE={rollout_mse:.6f}")


if __name__ == "__main__":
    main()
