"""FHIR adapter implementations for external EHR systems."""

from .adapter import EHRAdapter
from .external import CernerAdapter, EpicAdapter
from .hapi import HapiAdapter

__all__ = ["CernerAdapter", "EHRAdapter", "EpicAdapter", "HapiAdapter"]