"""OS-held exclusive runtime ownership, automatically released after a crash."""
import os


class RuntimeLease:
    def __init__(self,directory):
        directory.mkdir(parents=True,exist_ok=True)
        self.file=open(directory/'service.lock','a+b')
        try:
            if os.name=='nt':
                import msvcrt
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError as error:
            self.file.close()
            raise RuntimeError('IBKR runtime already owned by another service') from error

    def close(self):
        if not self.file.closed:
            if os.name=='nt':
                import msvcrt
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(),msvcrt.LK_UNLCK,1)
            self.file.close()

    def __enter__(self): return self
    def __exit__(self,*args): self.close()
