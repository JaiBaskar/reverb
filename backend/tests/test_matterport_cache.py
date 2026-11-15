from pathlib import Path

from properties import matterport


def test_write_atomic_never_exposes_a_partial_file(tmp_path: Path, monkeypatch):
    dest = tmp_path / "mesh" / "x.obj"
    seen = []
    real_replace = matterport.os.replace

    def spy(src, dst):
        seen.append(Path(dst).exists())  # the final file must not exist before the rename
        real_replace(src, dst)

    monkeypatch.setattr(matterport.os, "replace", spy)
    matterport.write_atomic(dest, b"v 0 0 0\n")
    assert dest.read_bytes() == b"v 0 0 0\n"
    assert seen == [False]
    assert not [p for p in dest.parent.iterdir() if p != dest]  # no temp file left behind
