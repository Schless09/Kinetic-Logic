"""Lightweight policy: (image, sensor) -> action (next sensor). BC head."""
import torch
import torch.nn as nn


class TinyCNN(nn.Module):
    """Small CNN for 64x64 RGB -> embedding."""

    def __init__(self, out_dim: int = 64):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(3, 16, 4, stride=2, padding=1),
            nn.ReLU(),
            nn.Conv2d(16, 32, 4, stride=2, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 64, 4, stride=2, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d(1),
        )
        self.out = nn.Linear(64, out_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, 3, H, W)
        h = self.conv(x)
        h = h.flatten(1)
        return self.out(h)


class BCPolicy(nn.Module):
    """Behavioral cloning: (image, sensor) -> action (6-d sensor prediction)."""

    def __init__(self, image_size: tuple[int, int] = (64, 64), sensor_dim: int = 6, hidden: int = 128):
        super().__init__()
        self.vision = TinyCNN(out_dim=hidden)
        self.sensor_dim = sensor_dim
        self.fc = nn.Sequential(
            nn.Linear(hidden + sensor_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, sensor_dim),
        )

    def forward(self, image: torch.Tensor, sensor: torch.Tensor) -> torch.Tensor:
        v = self.vision(image)
        x = torch.cat([v, sensor], dim=-1)
        return self.fc(x)
