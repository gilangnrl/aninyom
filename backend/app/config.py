import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

SUBTITLE_DIR = Path(os.getenv("SUBTITLE_DIR", str(DATA_DIR / "subtitles")))
CACHE_DIR = Path(os.getenv("CACHE_DIR", str(DATA_DIR / "cache")))

SUBTITLE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'aninyom.db'}")
DB_PATH = str(DATA_DIR / "aninyom.db")

PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")

HI_ANIME_BASE = os.getenv("HI_ANIME_BASE", "https://hianime.at")
ANILIST_GRAPHQL_URL = os.getenv("ANILIST_GRAPHQL_URL", "https://graphql.anilist.co")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
CORS_ORIGINS = [
    origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()
]

# HiAnime Megaplay AES Key and IV
MEGA_KEY = b"i?LMTAx0Q6,:}50U" + b"\x00" * 16
MEGA_IV = b"W0;27ToaUpl_P%'c"
XOR_KEY = b"otaku-embed-v1"
HI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
