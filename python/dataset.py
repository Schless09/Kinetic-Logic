"""PyTorch Dataset for (frame, sensor) -> action (next sensor) for BC."""
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset
from PIL import Image

from config import PROCESSED

SENSOR_COLS = [f"sensor_{d}" for d in ["accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z"]]
ACTION_COLS = [f"action_{d}" for d in ["accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z"]]


class VLADataset(Dataset):
    """Load (image, sensor_vec) -> action_vec from processed manifest + frames."""

    def __init__(
        self,
        manifest_path: Path | str,
        image_size: tuple[int, int] = (64, 64),
        base_path: Path | None = None,
    ):
        self.df = pd.read_parquet(manifest_path)
        self.image_size = image_size
        self.base = Path(base_path) if base_path else PROCESSED

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        row = self.df.iloc[idx]
        # Image: frame_path can be absolute or relative to processed/
        fp = row["frame_path"]
        path = Path(fp)
        if not path.is_absolute():
            path = self.base / fp
        else:
            path = path
        try:
            img = Image.open(path).convert("RGB")
        except Exception:
            img = Image.new("RGB", self.image_size, (128, 128, 128))
        # Resize
        img = img.resize(self.image_size, Image.BILINEAR)
        x_img = torch.from_numpy(np.array(img)).permute(2, 0, 1).float() / 255.0

        sensor = torch.tensor([row[c] for c in SENSOR_COLS], dtype=torch.float32)
        action = torch.tensor([row[c] for c in ACTION_COLS], dtype=torch.float32)
        return x_img, sensor, action


def collate_batch(batch: list) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    imgs = torch.stack([b[0] for b in batch])
    sensors = torch.stack([b[1] for b in batch])
    actions = torch.stack([b[2] for b in batch])
    return imgs, sensors, actions
