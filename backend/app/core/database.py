from collections.abc import Generator

from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    # Railway/Supabase may provide the older postgres:// scheme.
    if url.startswith(("postgres://", "postgresql://")):
        url = "postgresql+psycopg://" + url.split("://", 1)[1]
    sqlite = url.startswith("sqlite")
    if sqlite and url.startswith("sqlite:///"):
        from pathlib import Path

        db_path = Path(url.removeprefix("sqlite:///"))
        db_path.parent.mkdir(parents=True, exist_ok=True)
    engine_options = {
        "connect_args": {"check_same_thread": False} if sqlite else {},
    }
    if not sqlite:
        # Supabase may retire idle direct connections. Validate pooled connections
        # before a request receives one and periodically replace long-lived entries.
        engine_options.update(pool_pre_ping=True, pool_recycle=300, pool_size=5, max_overflow=5)
    engine = create_engine(url, **engine_options)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

    return engine


def session_factory(engine):
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_db(request: Request) -> Generator[Session, None, None]:
    with request.app.state.session_factory() as db:
        yield db
